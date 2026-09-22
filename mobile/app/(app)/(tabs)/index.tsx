import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, SectionTitle, ui } from "@/components/ui";
import { useAuth } from "@/context/AuthContext";
import { roleLabel } from "@/lib/auth-types";
import { canCaptureAttendance } from "@/lib/attendance-types";
import { fetchLinkedStudents, type LinkedStudent } from "@/lib/my-attendance-service";
import { colors } from "@/lib/theme";

type Tile = { label: string; detail: string; icon: string; href?: string };
const roleTiles: Record<string, Tile[]> = {
  student: [{ icon: "▣", label: "My learning", detail: "Open your enrolled learning from the mobile course workspace." }, { icon: "✓", label: "Attendance", detail: "Your attendance record and rate.", href: "/(app)/(tabs)/my-attendance" }, { icon: "★", label: "My exams", detail: "Sit your published exams and see results.", href: "/(app)/(tabs)/exams" }],
  parent: [{ icon: "◉", label: "My children", detail: "Linked children and their live school records." }, { icon: "✓", label: "Attendance", detail: "View attendance for your child.", href: "/(app)/(tabs)/my-attendance" }, { icon: "₦", label: "Fees", detail: "Balances and payments for your children.", href: "/(app)/(tabs)/my-fees" }],
  teacher: [{ icon: "▣", label: "My classes", detail: "Your assigned classes will appear here." }, { icon: "✓", label: "Take attendance", detail: "Mark today's register for your classes.", href: "/(app)/(tabs)/attendance" }, { icon: "★", label: "Assessments", detail: "Exam and assessment tools are coming next." }],
  staff: [{ icon: "▣", label: "School workspace", detail: "Your authorised work will appear here." }, { icon: "✓", label: "Take attendance", detail: "Mark the register for a class.", href: "/(app)/(tabs)/attendance" }, { icon: "✉", label: "Messages", detail: "Your school conversations.", href: "/(app)/(tabs)/messages" }],
  admin: [{ icon: "▣", label: "School overview", detail: "Operational insights will appear here." }, { icon: "✓", label: "Take attendance", detail: "Mark the register for any class.", href: "/(app)/(tabs)/attendance" }, { icon: "₦", label: "Finance", detail: "Authorised finance tools will appear here." }]
};

function TileCard({ tile }: { tile: Tile }) {
  const router = useRouter();
  const body = <Card><Text style={styles.tileIcon}>{tile.icon}</Text><Text style={styles.cardTitle}>{tile.label}</Text><Text style={ui.muted}>{tile.detail}</Text>{tile.href ? <Text style={styles.tileCta}>Open →</Text> : null}</Card>;
  if (!tile.href) return body;
  const target = tile.href;
  return <Pressable accessibilityRole="button" accessibilityLabel={tile.label} onPress={() => router.push(target as never)} style={({ pressed }) => pressed && styles.tilePressed}>{body}</Pressable>;
}

export default function DashboardScreen() {
  const { identity } = useAuth();
  const [linkedStudents, setLinkedStudents] = useState<LinkedStudent[]>([]);
  const [linkedStudentsLoading, setLinkedStudentsLoading] = useState(false);
  const [linkedStudentsError, setLinkedStudentsError] = useState<string | null>(null);
  useEffect(() => {
    if (!identity || (identity.role !== "parent" && identity.role !== "student")) return;
    setLinkedStudentsLoading(true);
    fetchLinkedStudents()
      .then(setLinkedStudents)
      .catch((error: unknown) => setLinkedStudentsError(error instanceof Error ? error.message : "Could not load linked students."))
      .finally(() => setLinkedStudentsLoading(false));
  }, [identity]);
  if (!identity) return null;
  const tiles = roleTiles[identity.role] ?? roleTiles.staff;
  const firstName = identity.fullName.split(" ")[0];
  const note = canCaptureAttendance(identity.role)
    ? "Attendance capture and messages are live on mobile."
    : identity.role === "student"
      ? "Exams, attendance and messages are live on mobile."
      : "Attendance and messages are live on mobile.";
  return <ScrollView style={ui.screen} contentContainerStyle={ui.content}><View style={styles.hero}><Text style={styles.school}>{identity.school.name}</Text><Text style={styles.greeting}>Hello, {firstName}</Text><View style={styles.badge}><Text style={styles.badgeText}>{roleLabel(identity.role)}</Text></View></View><SectionTitle title="Your school day" /><Card><Text style={styles.cardTitle}>You are signed in securely</Text><Text style={ui.muted}>This mobile portal is connected to {identity.school.name}. Only the features your school role is authorised to use will be shown.</Text></Card>{(identity.role === "parent" || identity.role === "student") ? <><SectionTitle title={identity.role === "parent" ? "Linked children" : "Your student record"} /><Card>{linkedStudentsLoading ? <Text style={ui.muted}>Loading linked records…</Text> : linkedStudentsError ? <Text style={styles.error}>{linkedStudentsError}</Text> : linkedStudents.length === 0 ? <Text style={ui.muted}>No linked student record is available.</Text> : linkedStudents.map((student) => <View key={student.id} style={styles.studentRow}><View><Text style={styles.cardTitle}>{student.fullName}</Text><Text style={ui.muted}>{student.studentCode || "No student code"}{student.grade ? ` · ${student.grade}` : ""}</Text></View><Text style={styles.tileCta}>Open attendance →</Text></View>)}</Card></> : null}<SectionTitle title="Quick access" /><View style={styles.grid}>{tiles.map((tile) => <TileCard key={tile.label} tile={tile} />)}</View><Text style={styles.note}>{note}</Text></ScrollView>;
}
const styles = StyleSheet.create({ hero: { backgroundColor: colors.navy, borderRadius: 20, padding: 20, gap: 7 }, school: { color: colors.gold, fontWeight: "800", fontSize: 14 }, greeting: { color: colors.white, fontSize: 27, fontWeight: "900" }, badge: { alignSelf: "flex-start", marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 99, backgroundColor: "#FFFFFF1F" }, badgeText: { color: "#DDE8F5", fontWeight: "700", fontSize: 12 }, grid: { gap: 12 }, tileIcon: { color: colors.gold, fontSize: 22, fontWeight: "800" }, cardTitle: { color: colors.navy, fontSize: 16, fontWeight: "800" }, tileCta: { color: colors.navyMid, fontWeight: "800", fontSize: 13, marginTop: 2 }, tilePressed: { opacity: 0.75 }, studentRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#E5E7EB" }, error: { color: "#B42318", fontSize: 13, lineHeight: 18 }, note: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "center", paddingVertical: 8 } });
