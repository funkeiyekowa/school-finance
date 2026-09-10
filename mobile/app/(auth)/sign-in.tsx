import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useAuth } from "@/context/AuthContext";
import { colors } from "@/lib/theme";
import { PrimaryButton, ui } from "@/components/ui";

export default function SignInScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    setError(""); setBusy(true);
    try { await signIn({ slug: slug ?? "", identifier, password }); router.replace("/(app)/(tabs)"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "We could not sign you in. Please try again."); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"><Pressable accessibilityRole="button" accessibilityLabel="Change school" onPress={() => router.replace("/(auth)/school")}><Text style={styles.change}>‹ Change school</Text></Pressable><View style={styles.logo}><Text style={styles.logoText}>S&T</Text></View><Text style={styles.school}>/{slug}</Text><Text style={styles.title}>Welcome back</Text><Text style={styles.copy}>Sign in with your student code or school email. Your access is checked against this school.</Text><View style={styles.form}><Text style={ui.label}>Email or student code</Text><TextInput autoCapitalize="none" autoCorrect={false} autoComplete="username" accessibilityLabel="Email or student code" placeholder="S288 or you@school.com" placeholderTextColor="#98A2B3" value={identifier} onChangeText={(value) => { setIdentifier(value); setError(""); }} style={ui.input} /><Text style={ui.label}>Password</Text><TextInput secureTextEntry autoComplete="current-password" accessibilityLabel="Password" placeholder="Enter your password" placeholderTextColor="#98A2B3" value={password} onChangeText={(value) => { setPassword(value); setError(""); }} onSubmitEditing={submit} style={ui.input} />{error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}<PrimaryButton label="Sign in securely" onPress={submit} busy={busy} /><Text style={styles.help}>Parents and staff use their school-issued email. Students may use their school-issued code.</Text></View></ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.canvas }, content: { padding: 24, paddingTop: 18, gap: 14 }, change: { color: colors.navyMid, fontWeight: "700", fontSize: 15 }, logo: { height: 58, width: 58, borderRadius: 16, marginTop: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.navy }, logoText: { color: colors.gold, fontWeight: "900", fontSize: 18 }, school: { color: colors.gold, fontWeight: "800", fontSize: 14, marginTop: 16 }, title: { color: colors.navy, fontSize: 30, fontWeight: "900" }, copy: { color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 14 }, form: { gap: 10, backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 18, padding: 18 }, help: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 4 } });
