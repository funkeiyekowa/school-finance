import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { Card, PrimaryButton, SectionTitle, ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { roleLabel } from "@/lib/auth-types";
import { colors } from "@/lib/theme";

export default function ProfileScreen() {
  const { identity, signOut } = useAuth();
  if (!identity) return null;
  const leave = () => Alert.alert("Sign out?", "You will need to sign in again to access your school portal.", [{ text: "Cancel", style: "cancel" }, { text: "Sign out", style: "destructive", onPress: async () => { await signOut(); router.replace("/(auth)/school"); } }]);
  return <ScrollView style={ui.screen} contentContainerStyle={ui.content}><View style={styles.avatar}><Text style={styles.initial}>{identity.fullName.charAt(0).toUpperCase()}</Text></View><Text style={styles.name}>{identity.fullName}</Text><Text style={styles.role}>{roleLabel(identity.role)}</Text><SectionTitle title="Account" /><Card><Text style={styles.detailLabel}>School</Text><Text style={styles.detail}>{identity.school.name}</Text><Text style={styles.detailLabel}>Access</Text><Text style={styles.detail}>{roleLabel(identity.role)}</Text>{identity.email && !identity.email.endsWith("@student.local") ? <><Text style={styles.detailLabel}>Email</Text><Text style={styles.detail}>{identity.email}</Text></> : null}</Card><SectionTitle title="Security" /><Card><Text style={styles.detail}>Your session is encrypted and stored securely on this device.</Text><Text style={ui.muted}>Never share your password or school-issued sign-in code.</Text></Card><PrimaryButton label="Sign out" onPress={leave} /></ScrollView>;
}
const styles = StyleSheet.create({ avatar: { height: 72, width: 72, borderRadius: 36, backgroundColor: colors.navy, alignItems: "center", justifyContent: "center", alignSelf: "center", marginTop: 16 }, initial: { color: colors.gold, fontSize: 30, fontWeight: "900" }, name: { color: colors.navy, fontSize: 24, fontWeight: "900", textAlign: "center" }, role: { color: colors.muted, fontSize: 14, textAlign: "center", marginTop: -10 }, detailLabel: { color: colors.muted, fontWeight: "700", fontSize: 12, textTransform: "uppercase", marginTop: 4 }, detail: { color: colors.ink, fontSize: 16, fontWeight: "600" } });
