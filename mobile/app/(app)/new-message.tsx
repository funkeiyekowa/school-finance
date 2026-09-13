import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Card, ui } from "@/components/ui";
import { colors } from "@/lib/theme";
import { createDirectConversation, searchMessageableUsers } from "@/lib/messaging-service";
import { initcap, type MessageableUser } from "@/lib/messaging-types";

export default function NewMessageScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageableUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        setSearching(true);
        setError(null);
        try {
          setResults(await searchMessageableUsers(query.trim()));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not search.");
          setResults([]);
        } finally {
          setSearching(false);
          setTouched(true);
        }
      })();
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query]);

  async function open(user: MessageableUser) {
    setOpening(user.user_id);
    setError(null);
    try {
      const id = await createDirectConversation(user.user_id);
      router.replace({ pathname: "/(app)/chat/[conversationId]", params: { conversationId: id, title: user.full_name } } as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : "You are not permitted to message this person.");
    } finally {
      setOpening(null);
    }
  }

  return (
    <View style={ui.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.barTitle}>New message</Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={ui.input}
          placeholder="Search by name…"
          placeholderTextColor={colors.muted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="words"
          autoCorrect={false}
        />
      </View>

      <ScrollView contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
        {error ? <Text style={ui.error}>{error}</Text> : null}

        {searching ? (
          <ActivityIndicator color={colors.navy} style={styles.spinner} />
        ) : results.length === 0 && touched ? (
          <Card>
            <Text style={styles.title}>No one to show</Text>
            <Text style={ui.muted}>
              You can only start conversations your school&apos;s messaging rules allow. Try a different name, or ask
              your school administrator who you are permitted to message.
            </Text>
          </Card>
        ) : (
          results.map((u) => (
            <Pressable
              key={u.user_id}
              accessibilityRole="button"
              accessibilityLabel={`Message ${u.full_name}`}
              disabled={opening !== null}
              onPress={() => void open(u)}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Card>
                <View style={styles.row}>
                  <View style={styles.avatar}>
                    <Text style={styles.initial}>{u.full_name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.name}>{u.full_name}</Text>
                    <Text style={ui.muted}>{u.subtitle || initcap(u.role)}</Text>
                  </View>
                  {opening === u.user_id ? <ActivityIndicator color={colors.navy} /> : null}
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 14, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.white, fontSize: 30, fontWeight: "800", lineHeight: 34 },
  barTitle: { color: colors.white, fontSize: 17, fontWeight: "800", flex: 1 },
  searchWrap: { padding: 16, paddingBottom: 4 },
  spinner: { marginTop: 20 },
  title: { color: colors.navy, fontSize: 16, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1 },
  avatar: { height: 42, width: 42, borderRadius: 21, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  initial: { color: colors.gold, fontSize: 17, fontWeight: "900" },
  name: { color: colors.navy, fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.75 },
});
