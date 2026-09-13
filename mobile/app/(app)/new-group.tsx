import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { Card, ui } from "@/components/ui";
import { colors } from "@/lib/theme";
import { createGroup, searchMessageableUsers } from "@/lib/messaging-service";
import { initcap, type MessageableUser } from "@/lib/messaging-types";

export default function NewGroupScreen() {
  const router = useRouter();
  const [groupName, setGroupName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MessageableUser[]>([]);
  const [selected, setSelected] = useState<MessageableUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
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

  function toggleMember(user: MessageableUser) {
    setSelected((prev) =>
      prev.some((u) => u.user_id === user.user_id)
        ? prev.filter((u) => u.user_id !== user.user_id)
        : [...prev, user],
    );
  }

  async function handleCreate() {
    const name = groupName.trim();
    if (!name) {
      setError("Please enter a group name.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const id = await createGroup(name, selected.map((u) => u.user_id));
      router.replace({ pathname: "/(app)/chat/[conversationId]", params: { conversationId: id, title: name } } as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create group.");
    } finally {
      setCreating(false);
    }
  }

  const selectedIds = new Set(selected.map((u) => u.user_id));
  const filteredResults = results.filter((u) => !selectedIds.has(u.user_id));

  return (
    <View style={ui.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <Text style={styles.barTitle}>New group</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create group"
          onPress={() => void handleCreate()}
          disabled={creating || !groupName.trim()}
          style={[styles.createBtn, (creating || !groupName.trim()) && styles.createBtnDisabled]}
        >
          {creating ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={styles.createBtnText}>Create</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.nameWrap}>
        <TextInput
          style={ui.input}
          placeholder="Group name (required)…"
          placeholderTextColor={colors.muted}
          value={groupName}
          onChangeText={setGroupName}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={80}
        />
      </View>

      {selected.length > 0 ? (
        <View style={styles.chips}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsInner}>
            {selected.map((u) => (
              <Pressable key={u.user_id} onPress={() => toggleMember(u)} style={styles.chip} accessibilityRole="button" accessibilityLabel={`Remove ${u.full_name}`}>
                <Text style={styles.chipText}>{u.full_name.split(" ")[0]}</Text>
                <Text style={styles.chipX}> ×</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.searchWrap}>
        <TextInput
          style={ui.input}
          placeholder="Add members…"
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
        ) : filteredResults.length === 0 && touched && query.trim().length > 0 ? (
          <Card>
            <Text style={styles.title}>No results</Text>
            <Text style={ui.muted}>Try a different name, or check your school&apos;s messaging permissions.</Text>
          </Card>
        ) : (
          filteredResults.map((u) => (
            <Pressable
              key={u.user_id}
              accessibilityRole="button"
              accessibilityLabel={`Add ${u.full_name} to group`}
              onPress={() => toggleMember(u)}
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
                  <Text style={styles.add}>+</Text>
                </View>
              </Card>
            </Pressable>
          ))
        )}

        {selected.length > 0 && query.trim().length === 0 ? (
          <Card>
            <Text style={styles.memberCount}>
              {selected.length} member{selected.length !== 1 ? "s" : ""} selected
            </Text>
            <Text style={ui.muted}>Search to add more, or tap Create when ready.</Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { backgroundColor: colors.navy, paddingTop: 52, paddingBottom: 14, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", gap: 4 },
  back: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.white, fontSize: 30, fontWeight: "800", lineHeight: 34 },
  barTitle: { color: colors.white, fontSize: 17, fontWeight: "800", flex: 1 },
  createBtn: { backgroundColor: colors.gold, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  createBtnDisabled: { opacity: 0.45 },
  createBtnText: { color: colors.navy, fontWeight: "800", fontSize: 14 },
  nameWrap: { padding: 16, paddingBottom: 4 },
  chips: { paddingHorizontal: 16, paddingBottom: 4 },
  chipsInner: { gap: 8, flexDirection: "row", paddingVertical: 4 },
  chip: { flexDirection: "row", alignItems: "center", backgroundColor: colors.navy, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: colors.white, fontSize: 13, fontWeight: "700" },
  chipX: { color: colors.gold, fontSize: 15, fontWeight: "900" },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 4 },
  spinner: { marginTop: 20 },
  title: { color: colors.navy, fontSize: 16, fontWeight: "800" },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1 },
  avatar: { height: 42, width: 42, borderRadius: 21, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center" },
  initial: { color: colors.gold, fontSize: 17, fontWeight: "900" },
  name: { color: colors.navy, fontSize: 15, fontWeight: "800" },
  add: { color: colors.navy, fontSize: 22, fontWeight: "900" },
  memberCount: { color: colors.navy, fontSize: 15, fontWeight: "800" },
  pressed: { opacity: 0.75 },
});
