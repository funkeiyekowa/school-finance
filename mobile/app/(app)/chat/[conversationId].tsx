import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/lib/theme";
import {
  getMessages,
  fetchAttachmentLimits,
  getNotificationPref,
  markRead,
  sendMessage,
  setNotificationPref,
  subscribeToConversation,
} from "@/lib/messaging-service";
import {
  clockStamp,
  initcap,
  NOTIFICATION_PREF_OPTIONS,
  type ChatAttachment,
  type ChatMessage,
  type NotificationPref,
} from "@/lib/messaging-types";
import {
  formatFileSize,
  getAttachmentSignedUrl,
  pickDocumentAttachment,
  pickImageAttachment,
  uploadAttachment,
  type PickedAttachment,
  type UploadedAttachment,
} from "@/lib/attachment-service";

export default function ChatScreen() {
  const { conversationId, title } = useLocalSearchParams<{ conversationId: string; title?: string }>();
  const { identity } = useAuth();
  const router = useRouter();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pending, setPending] = useState<PickedAttachment | null>(null);
  const [uploading, setUploading] = useState(false);
  const [limits, setLimits] = useState({ maxAttachmentMb: 15, allowedTypes: [] as string[] });
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [notifPref, setNotifPref] = useState<NotificationPref>("all");
  const [notifSheetOpen, setNotifSheetOpen] = useState(false);
  const [savingPref, setSavingPref] = useState(false);

  const scrollRef = useRef<ScrollView | null>(null);
  const atBottom = useRef(true);

  const load = useCallback(async () => {
    if (!conversationId) return;
    try {
      const rows = await getMessages(conversationId);
      setMessages(rows);
      setHasMore(rows.length === 40);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load messages.");
    } finally {
      setLoading(false);
    }
    void markRead(conversationId);
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetchAttachmentLimits().then(setLimits);
  }, []);

  useEffect(() => {
    if (!conversationId) return;
    void getNotificationPref(conversationId).then(setNotifPref);
  }, [conversationId]);

  async function onChangeNotifPref(next: NotificationPref) {
    if (!conversationId || savingPref) return;
    setSavingPref(true);
    const previous = notifPref;
    setNotifPref(next); // optimistic — the sheet feels instant
    try {
      await setNotificationPref(conversationId, next);
      setNotifSheetOpen(false);
    } catch (e) {
      setNotifPref(previous);
      setError(e instanceof Error ? e.message : "Could not update notification settings.");
    } finally {
      setSavingPref(false);
    }
  }

  useEffect(() => {
    if (!conversationId) return;
    return subscribeToConversation(conversationId, () => void load());
  }, [conversationId, load]);

  async function loadOlder() {
    if (!conversationId || loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const older = await getMessages(conversationId, messages[0]?.createdAt);
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length === 40);
    } catch {
      // Keep the thread usable; the newest messages are already shown.
    } finally {
      setLoadingMore(false);
    }
  }

  async function onPickImage() {
    setError(null);
    try {
      const picked = await pickImageAttachment();
      if (picked) setPending(picked);
    } catch {
      setError("Could not open your photo library.");
    }
  }

  async function onPickDocument() {
    setError(null);
    try {
      const picked = await pickDocumentAttachment();
      if (picked) setPending(picked);
    } catch {
      setError("Could not open the file picker.");
    }
  }

  async function onSend() {
    const body = draft.trim();
    if ((!body && !pending) || !conversationId || sending || uploading) return;
    setSending(true);
    setError(null);
    try {
      let attachments: UploadedAttachment[] = [];
      if (pending) {
        setUploading(true);
        const uploaded = await uploadAttachment(conversationId, pending, limits);
        attachments = [uploaded];
      }
      await sendMessage({ conversationId, body, replyToId: replyTo?.id ?? null, attachments });
      setDraft("");
      setReplyTo(null);
      setPending(null);
      await load();
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your message.");
    } finally {
      setSending(false);
      setUploading(false);
    }
  }

  async function onOpenAttachment(a: ChatAttachment) {
    setOpeningId(a.id);
    try {
      const url = await getAttachmentSignedUrl(a.storagePath);
      if (!url) {
        setError(`Could not open ${a.fileName}.`);
        return;
      }
      await Linking.openURL(url);
    } catch {
      setError(`Could not open ${a.fileName}.`);
    } finally {
      setOpeningId(null);
    }
  }

  if (!identity) return null;

  return (
    <KeyboardAvoidingView
      style={ui.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.barTitle} numberOfLines={1}>
          {title || "Conversation"}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Notification settings for this conversation"
          onPress={() => setNotifSheetOpen(true)}
          style={styles.notifBtn}
        >
          <Text style={styles.notifBtnIcon}>{notifPref === "muted" ? "🔕" : "🔔"}</Text>
        </Pressable>
      </View>

      <Modal
        visible={notifSheetOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setNotifSheetOpen(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setNotifSheetOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Notifications</Text>
            <Text style={styles.sheetSubtitle}>For this conversation only</Text>
            {NOTIFICATION_PREF_OPTIONS.map((opt) => {
              const selected = opt.value === notifPref;
              return (
                <Pressable
                  key={opt.value}
                  accessibilityRole="button"
                  accessibilityLabel={opt.label}
                  disabled={savingPref}
                  onPress={() => void onChangeNotifPref(opt.value)}
                  style={({ pressed }) => [styles.sheetOption, selected && styles.sheetOptionSelected, pressed && styles.pressed]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sheetOptionLabel}>{opt.label}</Text>
                    <Text style={styles.sheetOptionHint}>{opt.hint}</Text>
                  </View>
                  {selected ? <Text style={styles.sheetCheck}>✓</Text> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>

      {loading ? (
        <View style={styles.centre}>
          <ActivityIndicator size="large" color={colors.gold} />
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => {
            if (atBottom.current) scrollRef.current?.scrollToEnd({ animated: false });
          }}
          onScroll={(e) => {
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            atBottom.current = layoutMeasurement.height + contentOffset.y >= contentSize.height - 60;
            if (contentOffset.y <= 0) void loadOlder();
          }}
          scrollEventThrottle={80}
        >
          {loadingMore ? <ActivityIndicator color={colors.navy} style={styles.moreSpinner} /> : null}
          {!hasMore && messages.length > 0 ? <Text style={styles.threadStart}>Start of conversation</Text> : null}

          {messages.map((m) => {
            const mine = m.senderId === identity.userId;
            if (m.messageType === "system") {
              return (
                <Text key={m.id} style={styles.system}>
                  {m.body}
                </Text>
              );
            }
            return (
              <Pressable
                key={m.id}
                accessibilityRole="button"
                accessibilityLabel={`Reply to ${m.senderName}`}
                onLongPress={() => setReplyTo(m)}
                style={[styles.bubbleWrap, mine ? styles.bubbleWrapMine : styles.bubbleWrapTheirs]}
              >
                {!mine ? (
                  <Text style={styles.sender}>
                    {m.senderName}
                    {m.senderRole ? ` · ${initcap(m.senderRole)}` : ""}
                  </Text>
                ) : null}
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                  {m.replyToBody ? (
                    <View style={styles.quote}>
                      <Text style={styles.quoteText} numberOfLines={2}>
                        {m.replyToBody}
                      </Text>
                    </View>
                  ) : null}

                  {m.deletedAt ? (
                    <Text style={[styles.body, styles.deleted, mine && styles.bodyMine]}>Message deleted</Text>
                  ) : (
                    <>
                      {m.attachments.map((a) => (
                        <Pressable
                          key={a.id}
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${a.fileName}`}
                          onPress={() => void onOpenAttachment(a)}
                          disabled={openingId === a.id}
                          style={[styles.attachRow, mine && styles.attachRowMine]}
                        >
                          <Text style={[styles.attachIcon, mine && styles.bodyMine]}>
                            {a.fileType.startsWith("image/") ? "🖼️" : "📎"}
                          </Text>
                          <View style={{ flex: 1 }}>
                            <Text style={[styles.attachName, mine && styles.bodyMine]} numberOfLines={1}>
                              {a.fileName}
                            </Text>
                            <Text style={[styles.attachMeta, mine && styles.attachMetaMine]}>
                              {formatFileSize(a.fileSizeBytes)} · {openingId === a.id ? "Opening…" : "Tap to open"}
                            </Text>
                          </View>
                        </Pressable>
                      ))}
                      {m.body ? <Text style={[styles.body, mine && styles.bodyMine]}>{m.body}</Text> : null}
                    </>
                  )}

                  <Text style={[styles.time, mine && styles.timeMine]}>
                    {clockStamp(m.createdAt)}
                    {m.editedAt ? " · edited" : ""}
                  </Text>
                </View>
              </Pressable>
            );
          })}

          {messages.length === 0 ? <Text style={styles.empty}>No messages yet. Say hello.</Text> : null}
        </ScrollView>
      )}

      {error ? <Text style={styles.errorBar}>{error}</Text> : null}

      {replyTo ? (
        <View style={styles.replyBar}>
          <Text style={styles.replyText} numberOfLines={1}>
            Replying to {replyTo.senderName}: {replyTo.body ?? "attachment"}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={() => setReplyTo(null)}>
            <Text style={styles.replyCancel}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      {pending ? (
        <View style={styles.pendingBar}>
          <Text style={styles.pendingIcon}>{pending.mimeType.startsWith("image/") ? "🖼️" : "📎"}</Text>
          <Text style={styles.pendingText} numberOfLines={1}>
            {pending.name}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Remove attachment" onPress={() => setPending(null)}>
            <Text style={styles.replyCancel}>✕</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.composer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach a photo"
          onPress={() => void onPickImage()}
          disabled={sending || !!pending}
          style={({ pressed }) => [styles.attachBtn, pressed && styles.pressed, (sending || !!pending) && styles.sendOff]}
        >
          <Text style={styles.attachBtnIcon}>🖼️</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach a file"
          onPress={() => void onPickDocument()}
          disabled={sending || !!pending}
          style={({ pressed }) => [styles.attachBtn, pressed && styles.pressed, (sending || !!pending) && styles.sendOff]}
        >
          <Text style={styles.attachBtnIcon}>📎</Text>
        </Pressable>
        <TextInput
          style={styles.input}
          placeholder="Message…"
          placeholderTextColor={colors.muted}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={4000}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={(!draft.trim() && !pending) || sending}
          onPress={() => void onSend()}
          style={({ pressed }) => [styles.send, ((!draft.trim() && !pending) || sending) && styles.sendOff, pressed && styles.pressed]}
        >
          {sending ? <ActivityIndicator color={colors.navy} size="small" /> : <Text style={styles.sendText}>Send</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, alignItems: "center", justifyContent: "center" },
  bar: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 14, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.white, fontSize: 30, fontWeight: "800", lineHeight: 34 },
  barTitle: { color: colors.white, fontSize: 17, fontWeight: "800", flex: 1 },
  notifBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  notifBtnIcon: { fontSize: 20 },
  sheetBackdrop: { flex: 1, backgroundColor: "rgba(10,20,35,0.45)", justifyContent: "flex-end" },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34, gap: 4 },
  sheetTitle: { color: colors.navy, fontSize: 18, fontWeight: "800" },
  sheetSubtitle: { color: colors.muted, fontSize: 12, marginBottom: 10 },
  sheetOption: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingHorizontal: 4, borderRadius: 12 },
  sheetOptionSelected: { backgroundColor: "#EEF3F9" },
  sheetOptionLabel: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  sheetOptionHint: { color: colors.muted, fontSize: 12, marginTop: 1 },
  sheetCheck: { color: colors.gold, fontSize: 18, fontWeight: "900" },
  thread: { padding: 14, gap: 10 },
  moreSpinner: { marginVertical: 8 },
  threadStart: { textAlign: "center", color: colors.muted, fontSize: 11, fontWeight: "700", paddingVertical: 6 },
  bubbleWrap: { maxWidth: "85%" },
  bubbleWrapMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  bubbleWrapTheirs: { alignSelf: "flex-start" },
  sender: { color: colors.muted, fontSize: 11, fontWeight: "700", marginBottom: 3, marginLeft: 4 },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, gap: 3 },
  bubbleMine: { backgroundColor: colors.navy, borderBottomRightRadius: 5 },
  bubbleTheirs: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderBottomLeftRadius: 5 },
  quote: { borderLeftWidth: 3, borderLeftColor: colors.gold, paddingLeft: 8, marginBottom: 4, opacity: 0.85 },
  quoteText: { color: colors.muted, fontSize: 12, fontStyle: "italic" },
  body: { color: colors.ink, fontSize: 15, lineHeight: 21 },
  bodyMine: { color: colors.white },
  deleted: { fontStyle: "italic", opacity: 0.7 },
  attachRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#EEF3F9", borderRadius: 10, padding: 8, marginBottom: 4, minWidth: 180 },
  attachRowMine: { backgroundColor: "#1B3E63" },
  attachIcon: { fontSize: 18 },
  attachName: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  attachMeta: { color: colors.muted, fontSize: 11 },
  attachMetaMine: { color: "#B9CBE0" },
  time: { color: colors.muted, fontSize: 10, marginTop: 2 },
  timeMine: { color: "#B9CBE0" },
  system: { textAlign: "center", color: colors.muted, fontSize: 12, fontStyle: "italic", paddingVertical: 4 },
  empty: { textAlign: "center", color: colors.muted, paddingVertical: 30 },
  errorBar: { backgroundColor: colors.dangerSoft, color: colors.danger, fontWeight: "700", fontSize: 13, padding: 10, textAlign: "center" },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#EEF3F9", paddingHorizontal: 14, paddingVertical: 9 },
  replyText: { flex: 1, color: colors.navyMid, fontSize: 12, fontWeight: "600" },
  replyCancel: { color: colors.muted, fontSize: 16, fontWeight: "800" },
  pendingBar: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#FFF8E8", paddingHorizontal: 14, paddingVertical: 9 },
  pendingIcon: { fontSize: 16 },
  pendingText: { flex: 1, color: colors.navyMid, fontSize: 12, fontWeight: "700" },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12, paddingBottom: 26, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.white },
  attachBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  attachBtnIcon: { fontSize: 17 },
  input: { flex: 1, minHeight: 46, maxHeight: 130, borderColor: colors.line, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, color: colors.ink, fontSize: 15, backgroundColor: colors.canvas },
  send: { height: 46, borderRadius: 23, paddingHorizontal: 20, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  sendOff: { opacity: 0.45 },
  sendText: { color: colors.navy, fontWeight: "800", fontSize: 15 },
  pressed: { opacity: 0.75 },
});
