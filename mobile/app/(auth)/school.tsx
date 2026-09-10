import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { colors } from "@/lib/theme";
import { PrimaryButton, ui } from "@/components/ui";

export default function SchoolScreen() {
  const [slug, setSlug] = useState("");
  const [error, setError] = useState("");
  const continueToLogin = () => {
    const value = slug.trim().toLowerCase().replace(/^\/?s\//, "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) { setError("Enter the school address name, for example grant-schools."); return; }
    router.push({ pathname: "/(auth)/sign-in", params: { slug: value } });
  };
  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}><View style={styles.brand}><Text style={styles.mark}>S&T</Text><Text style={styles.brandText}>Smart & Thrive</Text><Text style={styles.brandSub}>School portal</Text></View><View style={styles.panel}><Text style={styles.title}>Find your school</Text><Text style={styles.copy}>Enter the address name from your school portal. This keeps your sign-in connected to the right school.</Text><Text style={ui.label}>School address name</Text><TextInput autoCapitalize="none" autoCorrect={false} accessibilityLabel="School address name" placeholder="grant-schools" placeholderTextColor="#98A2B3" value={slug} onChangeText={(value) => { setSlug(value); setError(""); }} onSubmitEditing={continueToLogin} style={ui.input} /><Text style={styles.example}>For example: your website ends in /s/grant-schools/login</Text>{error ? <Text accessibilityRole="alert" style={ui.error}>{error}</Text> : null}<PrimaryButton label="Continue" onPress={continueToLogin} /></View><Text style={styles.footer}>Use the same school-issued sign-in details you use on the web portal.</Text></KeyboardAvoidingView></SafeAreaView>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.navy }, brand: { paddingHorizontal: 28, paddingTop: 56, paddingBottom: 38 }, mark: { backgroundColor: colors.gold, color: colors.navy, overflow: "hidden", borderRadius: 10, paddingVertical: 7, paddingHorizontal: 9, fontWeight: "900", alignSelf: "flex-start", marginBottom: 14 }, brandText: { color: colors.white, fontSize: 28, fontWeight: "900" }, brandSub: { color: "#D0D5DD", fontSize: 15, marginTop: 4 }, panel: { flex: 1, backgroundColor: colors.canvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 28, gap: 12 }, title: { color: colors.navy, fontSize: 27, fontWeight: "900" }, copy: { color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 14 }, example: { color: colors.muted, fontSize: 12, lineHeight: 18, marginBottom: 10 }, footer: { color: "#C7D1DE", textAlign: "center", paddingHorizontal: 28, paddingBottom: 22, fontSize: 12, lineHeight: 18 } });
