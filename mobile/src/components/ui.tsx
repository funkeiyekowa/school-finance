import type { PropsWithChildren, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@/lib/theme";

export function PrimaryButton({ label, onPress, busy = false, disabled = false }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy || disabled} onPress={onPress} style={({ pressed }) => [styles.button, (busy || disabled) && styles.buttonDisabled, pressed && styles.buttonPressed]}>
    {busy ? <ActivityIndicator color={colors.navy} /> : <Text style={styles.buttonText}>{label}</Text>}
  </Pressable>;
}

export function Card({ children }: PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) {
  return <View style={styles.sectionTitle}><Text style={styles.sectionHeading}>{title}</Text>{action}</View>;
}

export function LoadingScreen() {
  return <View style={styles.loading}><ActivityIndicator size="large" color={colors.gold} /><Text style={styles.loadingText}>Preparing your school portal…</Text></View>;
}

export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, gap: 16 },
  label: { color: colors.ink, fontSize: 14, fontWeight: "600", marginBottom: 7 },
  input: { borderColor: colors.line, borderWidth: 1, borderRadius: 12, backgroundColor: colors.white, paddingHorizontal: 14, height: 50, color: colors.ink, fontSize: 16 },
  error: { color: colors.danger, backgroundColor: colors.dangerSoft, borderColor: "#FECDCA", borderWidth: 1, borderRadius: 10, padding: 12, lineHeight: 20 },
  muted: { color: colors.muted, fontSize: 14, lineHeight: 20 }
});

const styles = StyleSheet.create({
  button: { height: 52, borderRadius: 12, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  buttonText: { color: colors.navy, fontSize: 16, fontWeight: "800" },
  buttonDisabled: { opacity: 0.55 },
  buttonPressed: { opacity: 0.8 },
  card: { backgroundColor: colors.white, borderRadius: 16, borderWidth: 1, borderColor: colors.line, padding: 16, gap: 8 },
  sectionTitle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
  sectionHeading: { fontSize: 18, fontWeight: "800", color: colors.navy },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14, backgroundColor: colors.navy },
  loadingText: { color: colors.white, fontWeight: "600" }
});
